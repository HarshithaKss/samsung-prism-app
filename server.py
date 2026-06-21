import os
import io
import time
import base64
import traceback
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import threading

import tensorflow as tf

# -------------------------------------------------------------
# GTSRB DIRECTION SIGN SUB-CLASSIFIER (local timm model)
# -------------------------------------------------------------
# GTSRB class IDs 33-40 are direction signs
GTSRB_DIRECTION_LABELS = {
    33: 'Turn right ahead',
    34: 'Turn left ahead',
    35: 'Ahead only',
    36: 'Go straight or right',
    37: 'Go straight or left',
    38: 'Keep right',
    39: 'Keep left',
    40: 'Roundabout mandatory',
}

# Module-level model cache — loaded once at startup
_gtsrb_model = None
_gtsrb_processor = None
models_ready = False

import os
IS_PRODUCTION = os.environ.get('RENDER', False)

def _load_gtsrb_model():
    global _gtsrb_model, _gtsrb_processor
    if IS_PRODUCTION:
        _gtsrb_model = None
        _gtsrb_processor = None
        return
    try:
        import torch
        import timm
        from huggingface_hub import hf_hub_download
        from torchvision import transforms

        weights_path = hf_hub_download(repo_id='bazyl/gtsrb-model', filename='pytorch_model.bin')
        model = timm.create_model('vit_base_patch16_224', pretrained=False, num_classes=43)
        state_dict = torch.load(weights_path, map_location='cpu')
        if 'model_state_dict' in state_dict:
            state_dict = state_dict['model_state_dict']
        model.load_state_dict(state_dict, strict=False)
        model.eval()
        _gtsrb_model = model
        _gtsrb_processor = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])
        print('[+] GTSRB sub-classifier loaded successfully.')
    except Exception as e:
        print(f'[-] GTSRB failed: {e}')
        _gtsrb_model = None
        _gtsrb_processor = None


def get_direction_subclass(pil_image):
    """Run local GTSRB inference and return the best direction sign label (IDs 33-40)."""
    if IS_PRODUCTION or _gtsrb_model is None or _gtsrb_processor is None:
        return None
    try:
        import torch

        input_tensor = _gtsrb_processor(pil_image).unsqueeze(0)  # [1, C, H, W]

        with torch.no_grad():
            logits = _gtsrb_model(input_tensor)           # [1, 43] raw logits
            probs = torch.softmax(logits, dim=1)[0]       # [43]

        # Filter only direction sign class IDs 33-40
        best_label = None
        best_score = -1.0
        for class_id, label_name in GTSRB_DIRECTION_LABELS.items():
            score = float(probs[class_id])
            if score > best_score:
                best_score = score
                best_label = label_name

        print(f'[+] GTSRB direction sub-class: {best_label} (score={best_score:.4f})')
        return best_label
    except Exception as e:
        print(f'[-] GTSRB direction sub-classification inference failed: {e}')
        return None

app = Flask(__name__)
CORS(app) # Enable CORS for cross-origin local fetch requests

# Path to the TFLite classification model
MODEL_PATH = 'model/model_qad_int8.tflite'

# The exact 9 classes in the requested order
CLASSES = [
    "Magazine Cover",
    "Movie Poster",
    "book",
    "business_cards",
    "direction_traffic_signs",
    "government_ids",
    "maps",
    "menu",
    "newspaper"
]

# Load and configure the TFLite Interpreter
interpreter = None
input_details = None
output_details = None

def _load_tflite_model():
    global interpreter, input_details, output_details
    print(f"[*] Loading TFLite model from: {MODEL_PATH}...")
    try:
        interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        print("[+] TFLite Model loaded successfully!")
        print(f"  Input Details: {input_details}")
        print(f"  Output Details: {output_details}")
    except Exception as e:
        print(f"[-] Error loading TFLite model: {e}")


@app.route('/classify', methods=['POST'])
def classify():
    global models_ready
    if not models_ready:
        _load_gtsrb_model()
        _load_tflite_model()
        models_ready = True

    if interpreter is None:
        return jsonify({'error': 'TFLite Model is not loaded on server.'}), 500

    try:
        # 1. Parse JSON payload
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'error': 'Missing image parameter in request JSON body.'}), 400

        # 2. Decode base64 image data
        image_b64 = data['image']
        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]
        
        # Strip any whitespace/newlines and apply robust padding
        image_b64 = image_b64.strip()
        missing_padding = len(image_b64) % 4
        if missing_padding:
            image_b64 += '=' * (4 - missing_padding)
            
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')

        # 3. Read input requirements from model metadata
        input_shape = input_details[0]['shape'] # usually [1, 224, 224, 3]
        input_dtype = input_details[0]['dtype'] # float32 or uint8
        
        target_w = input_shape[2]
        target_h = input_shape[1]

        # 4. Preprocess Image (Resize to target resolution)
        image_resized = image.resize((target_w, target_h), Image.Resampling.BILINEAR)
        input_data = np.array(image_resized, dtype=np.uint8)

        # Add batch dimension [1, H, W, C]
        input_data = np.expand_dims(input_data, axis=0)

        # 5. Execute TFLite Inference & Track Speed
        start_time = time.time()
        
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        
        # Retrieve prediction output vector
        output_data = interpreter.get_tensor(output_details[0]['index'])[0]
        
        inference_time_ms = int((time.time() - start_time) * 1000)

        # 6. Dequantize output scores using scale and zero_point
        scale, zero_point = output_details[0]['quantization']
        scores = (output_data.astype(np.float32) - zero_point) * scale

        # 7. Apply Softmax to get proper probabilities
        exp_scores = np.exp(scores - np.max(scores))
        scores = exp_scores / np.sum(exp_scores)

        # 8. Resolve final predicted class index
        top1_idx = int(np.argmax(scores))
        confidence = float(scores[top1_idx])
        
        # Guard index in case model has more/fewer class outputs than defined
        label = CLASSES[top1_idx] if top1_idx < len(CLASSES) else "Unknown"

        # Format float scores array to exactly 9 classes
        all_scores_list = scores.tolist()
        if len(all_scores_list) < len(CLASSES):
            # Pad with 0.0 if model has fewer output indexes
            all_scores_list += [0.0] * (len(CLASSES) - len(all_scores_list))
        elif len(all_scores_list) > len(CLASSES):
            # Slice to 9 if model has extra output indexes
            all_scores_list = all_scores_list[:len(CLASSES)]

        # 9. If prediction is direction_traffic_signs, run local GTSRB sub-classifier
        sub_class = None
        if label == 'direction_traffic_signs':
            print('[*] direction_traffic_signs predicted - running GTSRB sub-classifier...')
            sub_class = get_direction_subclass(image)

        return jsonify({
            'label': label,
            'confidence': confidence,
            'all_scores': all_scores_list,
            'inference_time_ms': max(1, inference_time_ms),
            'sub_class': sub_class,
        })

    except Exception as e:
        traceback.print_exc()
        print(f"[-] Error during classification: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"[*] Starting TFLite Flask Inference Server on port {port}...")
    app.run(host='0.0.0.0', port=port, debug=False)
