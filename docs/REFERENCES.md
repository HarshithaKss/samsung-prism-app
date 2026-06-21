# References — repositories & models used

## HuggingFace models
| Model | Used for | Link |
|---|---|---|
| `openai/clip-vit-base-patch32` | Zero-shot auto-cleaning of scraped real-world training images | https://huggingface.co/openai/clip-vit-base-patch32 |
| `bazyl/gtsrb-model` | Direction-sign sub-classifier (8 sign types) | https://huggingface.co/bazyl/gtsrb-model |

## GitHub repositories / libraries
| Project | Used for | Link |
|---|---|---|
| TensorFlow / Keras | MobileNetV2 & EfficientNetB0 backbones (ImageNet) + training/TFLite export | https://github.com/keras-team/keras · https://github.com/tensorflow/tensorflow |
| TensorFlow Model Optimization Toolkit (`tfmot`) | Quantization-Aware Training (QAT) for QAD | https://github.com/tensorflow/model-optimization |
| HuggingFace Transformers | Loading/running CLIP | https://github.com/huggingface/transformers |
| `timm` (PyTorch Image Models) | Loading the GTSRB ViT (`vit_base_patch16_224`) | https://github.com/huggingface/pytorch-image-models |
| LiteRT / `ai-edge-litert` | TFLite int8 inference runtime | https://github.com/google-ai-edge/litert |

## Pretrained weights
- **MobileNetV2** and **EfficientNetB0**: ImageNet weights via `tf.keras.applications`.

## Our implementation artifacts (Kaggle)
| Artifact | Link |
|---|---|
| Trained model (`model_qad_int8.tflite`, public) | https://www.kaggle.com/models/siddhm11/samsung-prism-doc-classifier |
| Training dataset (9 classes) | https://www.kaggle.com/datasets/sidsingh123456/new-updated-dataset |
| Training code (QAD pipeline) | https://www.kaggle.com/code/siddhm11/samsung-prism-qad-clean |
| Live demo notebook | https://www.kaggle.com/code/siddhm11/samsung-prism-document-classifier-demo |
