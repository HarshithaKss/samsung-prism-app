# System Architecture

Samsung PRISM — 9-Class Document Image Classifier.

![System architecture](system_architecture.png)

## Overview
The system has three stages:

1. **Model training** — an EfficientNetB0 **teacher** and a MobileNetV2 **student** are
   fine-tuned on the 9-class dataset. The student is then trained with **Quantization-Aware
   Distillation (QAD)** — quantization-aware training while learning from the teacher's soft
   labels — and exported to a **full-int8 TFLite** model (`model_qad_int8.tflite`, 2.7 MB).
2. **Data-quality pipeline** — real-world photos are scraped and auto-filtered with **CLIP
   zero-shot** classification (keeping only correctly-labelled images), then merged into the
   training set to close the clean-scan → real-photo domain gap.
3. **Inference** — an image is resized to 224×224 (raw uint8, no normalization — the
   `[0,255]→[-1,1]` scaling is baked into the int8 input quantization), run through the int8
   model + softmax, giving a 9-class label + confidence. If the prediction is a **direction
   traffic sign**, a GTSRB Vision-Transformer sub-classifier identifies the specific sign type.

## Diagram (GitHub-rendered)
```mermaid
flowchart TD
    subgraph T["1) Model training"]
        DS["9-Class Dataset<br/>(Kaggle, 224x224 RGB)"]
        TE["Teacher: EfficientNetB0<br/>ImageNet → fine-tuned"]
        ST["Student: MobileNetV2 (α=1.0)<br/>ImageNet → fine-tuned"]
        QAD["Quantization-Aware Distillation<br/>(QAT + KD, T=4, α=0.5)"]
        TFL["model_qad_int8.tflite<br/>2.7 MB · 96.9% test"]
        DS --> TE
        DS --> ST
        TE -->|soft labels| QAD
        ST --> QAD
        QAD -->|export int8| TFL
    end

    subgraph D["2) Data-quality pipeline"]
        WEB["Scraped real-world photos"]
        CLIP["CLIP zero-shot auto-filter<br/>(openai/clip-vit-base-patch32)"]
        CLEAN["Clean real images"]
        WEB --> CLIP --> CLEAN
    end
    CLEAN -.->|merge oversampled| ST

    subgraph I["3) Inference"]
        IMG["Input image"]
        PRE["Resize 224x224<br/>RAW uint8"]
        MDL["int8 TFLite model + softmax"]
        OUT["9-class label + confidence"]
        SUB["Direction signs →<br/>GTSRB ViT sub-classifier<br/>(HF bazyl/gtsrb-model)"]
        IMG --> PRE --> MDL --> OUT
        OUT --> SUB
    end
    TFL -->|deploy| MDL
```

See [`MODELS.md`](MODELS.md) for model/fine-tuning details and
[`REFERENCES.md`](REFERENCES.md) for the GitHub/HuggingFace sources used.
