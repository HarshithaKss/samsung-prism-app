# Live Demo (Kaggle)

Try the model in your browser — **no installation required**:

**▶ https://www.kaggle.com/code/siddhm11/samsung-prism-document-classifier-demo**

## Just want to look
Open the link — the notebook already shows **finished outputs**: a gallery of real-world
photos classified by the model, each labelled with its prediction and confidence
(green = correct).

## Run it yourself (zero setup)
1. Click **Copy & Edit** (top-right).
2. **Run → Run All**.

That's it. The trained model (`model_qad_int8.tflite`) and the sample images are
pre-attached as public data — no pip installs, no internet needed.

## What the notebook does
- Loads the int8 TFLite model.
- Runs it on a gallery of **real-world sample photos** (direction signs, maps, business
  cards, menus, books, newspapers, etc.) and shows each image with its predicted class +
  confidence.

## Try your own image
1. In the right panel: **Add Data → Upload** and add an image.
2. In the last code cell, set `TEST_IMAGE = '/kaggle/input/<your-uploaded-file>'`.
3. Re-run that cell — it displays your image with the predicted class and confidence.

## Run locally instead
```bash
pip install pillow numpy ai-edge-litert      # (or: pip install ... tensorflow)
python inference.py path/to/image.jpg        # single image
python inference.py samples/                  # a folder of images
```
The model takes **raw 224×224 uint8 pixels** (the `[0,255]→[-1,1]` normalization is baked
into the int8 quantization), and outputs a 9-class label + confidence.
