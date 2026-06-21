# Models Used & Fine-Tuning

| Model | Role | Source / pretrained weights | Fine-tuned by us? |
|---|---|---|---|
| **MobileNetV2** (α=1.0) | Deployed 9-class document classifier (student) | `tf.keras.applications`, ImageNet | **Yes** — full recipe below |
| **EfficientNetB0** | Teacher (for distillation only) | `tf.keras.applications`, ImageNet | **Yes** — fine-tuned on the 9 classes |
| **CLIP ViT-B/32** | Data-cleaning tool (zero-shot filter for scraped images) | HF `openai/clip-vit-base-patch32` | No — used pretrained, zero-shot |
| **GTSRB ViT** (`vit_base_patch16_224`) | Direction-sign sub-classifier (routing) | HF `bazyl/gtsrb-model` (via `timm`) | No — used pretrained (43 GTSRB classes → 8 direction signs) |

## Deployed model — MobileNetV2 (the one in `model/model_qad_int8.tflite`)

**Base:** MobileNetV2 (width multiplier α=1.0), ImageNet-pretrained, with a new
Dropout(0.2) + Dense(9, softmax) head. Input 224×224×3.

**Fine-tuning (transfer learning):**
- **Phase A** — freeze the backbone, train only the head (Adam, lr 1e-3).
- **Phase B** — unfreeze the **top ~80 layers** (BatchNorm layers kept frozen), fine-tune
  at a low lr (5e-5) with capture-realistic augmentation (flip, rotation, zoom-out for
  framing, translation, brightness/contrast).

**Knowledge Distillation (KD):** the student also learns from the EfficientNetB0 teacher's
softened outputs. Loss = α·CE(hard labels) + (1−α)·KL(softmax(teacher/T), softmax(student/T))·T²,
with **T = 4, α = 0.5**.

**Quantization-Aware Distillation (QAD):** the distilled student is wrapped with
quantization-aware training (`tensorflow_model_optimization`) and fine-tuned further while
still receiving the teacher's soft labels, then exported **directly to full-int8 TFLite**.
This removes the post-training-quantization accuracy drop (the model learns int8-robust
weights). QAD int8 = **96.9%** test, beating sequential KD→PTQ (96.4%) and the plain
baseline (95.1%).

**Quantization details:** full-int8, **uint8 input/output**. The `[0,255]→[-1,1]`
normalization is folded into the int8 input quantization, so the app feeds **raw pixels**.

## Teacher — EfficientNetB0
ImageNet-pretrained, fine-tuned on the 9 classes (head, then top fine-tune with BatchNorm
frozen). Used only to generate soft labels for distillation; **not deployed**.

## Sub-classifier — GTSRB ViT (direction signs)
Pretrained `bazyl/gtsrb-model` (German Traffic Sign Recognition Benchmark, 43 classes,
ViT-B/16). Used **as-is**; outputs are filtered to the 8 direction-sign classes (GTSRB IDs
33–40). Invoked only when the main classifier predicts `direction_traffic_signs`.

## Data-cleaning model — CLIP
`openai/clip-vit-base-patch32`, zero-shot. Given scraped real-world photos, it keeps only
images whose top zero-shot label matches the intended class — auto-removing mislabeled
scrapes before they enter training. Not part of the deployed app.
