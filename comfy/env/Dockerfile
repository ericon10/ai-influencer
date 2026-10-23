# ComfyUI for Character Studio, frozen (UX-PLAN.md section 41, E3). Every
# version here is pinned and matches environment.lock.json; the agent
# reports the hash of what it finds, and the Studio refuses jobs when it
# differs. An upgrade is a new lock: build, test, then switch in Settings.
#
# Build on the machine: docker build -t studio-comfy:1 -f comfy/env/Dockerfile .
# Models are not in the image. They live on the machine's disk, mounted at
# /models (see docs/COMFY.md), and are never downloaded at job time.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ARG COMFYUI_COMMIT=d07dff4565ea9804277fff8cdfa0c817e08c3d44
ARG CONTROLNET_AUX_COMMIT=a587a4c1594524c1d2de5cd1a86cd868ff448e1c
ARG SAM2_COMMIT=0c35fff5f382803e2310103357b5e985f5437f32
ARG KJNODES_COMMIT=74b7f1731cfd0208ae50b9ffc55145564c25e65f
ARG AITOOLKIT_COMMIT=7cc9fef46927a2737049e7d31ec99d6de2448665

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-pip git ffmpeg curl ca-certificates libgl1 libglib2.0-0 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
RUN python3.12 -m venv /venv
ENV PATH=/venv/bin:$PATH

# PyTorch for CUDA 12.8, pinned.
RUN pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128

# ComfyUI at its commit, then each custom node at its commit.
RUN git clone https://github.com/comfyanonymous/ComfyUI /comfy/ComfyUI && cd /comfy/ComfyUI && git checkout $COMFYUI_COMMIT \
  && pip install -r requirements.txt
WORKDIR /comfy/ComfyUI/custom_nodes
RUN git clone https://github.com/Fannovel16/comfyui_controlnet_aux && cd comfyui_controlnet_aux && git checkout $CONTROLNET_AUX_COMMIT && pip install -r requirements.txt
RUN git clone https://github.com/kijai/ComfyUI-segment-anything-2 && cd ComfyUI-segment-anything-2 && git checkout $SAM2_COMMIT
RUN git clone https://github.com/kijai/ComfyUI-KJNodes && cd ComfyUI-KJNodes && git checkout $KJNODES_COMMIT && pip install -r requirements.txt

# The LoRA trainer at its commit, in its own venv.
RUN git clone https://github.com/ostris/ai-toolkit /comfy/ai-toolkit && cd /comfy/ai-toolkit && git checkout $AITOOLKIT_COMMIT \
  && python3.12 -m venv /comfy/ai-toolkit/venv && /comfy/ai-toolkit/venv/bin/pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128 \
  && /comfy/ai-toolkit/venv/bin/pip install -r requirements.txt

# The agent (no dependencies; Node 22) and the lock it checks against.
COPY comfy/agent /comfy/agent
COPY comfy/env/environment.lock.json comfy/env/models.json /comfy/env/
COPY comfy/env/extra_model_paths.yaml /comfy/ComfyUI/extra_model_paths.yaml
COPY comfy/env/start.sh /comfy/start.sh
RUN chmod +x /comfy/start.sh && ln -s /comfy/agent/agent.mjs /usr/local/bin/comfy-agent

ENV COMFY_DIR=/comfy/ComfyUI COMFY_URL=http://127.0.0.1:8188 COMFY_LOCK=/comfy/env/environment.lock.json \
    COMFY_MODELS=/models AITOOLKIT_DIR=/comfy/ai-toolkit
# ComfyUI listens on the container's loopback only; nothing is published.
CMD ["/comfy/start.sh"]
