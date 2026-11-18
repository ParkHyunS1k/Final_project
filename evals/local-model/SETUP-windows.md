# 데스크톱(Windows + NVIDIA) 준비와 스모크

1단계-1의 장비 준비다. 서빙은 Windows `llama-server.exe`, 학습은 WSL2(1단계-4 전에 준비), 맥은 SSH 터널로만 붙는다.
버전·파일 이름은 실행 시 공식 페이지에서 확인한다. 아래 이름은 예시다.

## 1. GPU 확인 (PowerShell)

```powershell
nvidia-smi
```

GPU 이름, 드라이버 버전, CUDA 버전을 `REPORT.md`에 적는다. RTX 50 시리즈면 llama.cpp·PyTorch도 그 CUDA를 지원하는 빌드여야 한다.

## 2. OpenSSH 서버 (관리자 PowerShell)

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

맥의 공개키(`~/.ssh/id_ed25519.pub`)를 넣는다. Windows 계정이 관리자면 `C:\ProgramData\ssh\administrators_authorized_keys`, 아니면 `C:\Users\<계정>\.ssh\authorized_keys`다.
맥 `~/.ssh/config`에 추가한다.

```
Host desktop
  HostName <데스크톱 IP>
  User <Windows 계정>
```

포트 8080·8081은 방화벽에서 열지 않는다. 터널로만 쓴다.

## 3. llama.cpp와 모델

- llama.cpp GitHub Releases에서 Windows CUDA 빌드 zip과 같은 버전의 cudart zip을 받아 `C:\llama`에 푼다.
- Hugging Face에서 Qwen3.5 9B Instruct GGUF(Q4_K_M)를 `C:\models`에 받는다. 받은 파일의 SHA-256을 `REPORT.md`에 적는다.

```powershell
certutil -hashfile C:\models\<파일>.gguf SHA256
```

## 4. base 서버 (PowerShell)

```powershell
C:\llama\llama-server.exe -m C:\models\<파일>.gguf --host 127.0.0.1 --port 8080 --ctx-size 8192 --parallel 1 -ngl 99 --jinja
```

`--jinja`는 `run.py`가 보내는 `chat_template_kwargs`(사고 모드 끄기)에 필요하다.

## 5. 맥에서 스모크

```bash
ssh -N -L 8080:127.0.0.1:8080 -L 8081:127.0.0.1:8081 desktop
```

다른 터미널에서:

```bash
curl -s 127.0.0.1:8080/health
python3 evals/local-model/make_split.py --smoke
EVAL_API_URL=http://127.0.0.1:8080/v1/chat/completions EVAL_API_KEY=local EVAL_ADAPTER_SHA=base \
  python3 evals/github-timeline-state-change-2026-09-11/run.py --variant local \
  --candidates evals/local-model/out/smoke.jsonl --results-dir evals/local-model/out/smoke --all --workers 1
```

**합격:** 3줄 모두 `success`, 응답에 사고 태그가 없다. 실패하면 `evals/local-model/out/smoke/*.json`을 확인한다.
`response_format`이 무시되면 스키마 위반으로 실패한다. 그때는 Gemma 4 E4B로 1회 바꾸고, 그래도 실패하면 멈춘다.
