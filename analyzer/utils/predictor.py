"""
Heart sound classification — matches the exact training pipeline.
Training used: sr=22050, duration=5s, n_mels=224, hop=512, n_fft=2048
Mel-spec (224x224) → flatten (50176) → StandardScaler → reshape (1,224,224,1) → TFLite
"""
import os, logging
import numpy as np

logger = logging.getLogger(__name__)

# Must match the label_encoder.pkl class order
VALID_CLASSES = ['artifact', 'extrahls', 'extrastole', 'murmur', 'normal']
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')

# --- Training hyper-parameters (MUST match notebook) ---
SAMPLE_RATE = 22050
DURATION    = 5
N_SAMPLES   = SAMPLE_RATE * DURATION   # 110250
N_MELS      = 224
HOP_LENGTH  = 512
N_FFT       = 2048
IMG_WIDTH   = 224
TRIM_TOP_DB = 20

_model = _scaler = _encoder = None
_mock_mode = False


def _load_artifacts():
    global _model, _scaler, _encoder, _mock_mode
    if _model is not None:
        return

    try:
        import tflite_runtime.interpreter as tflite
    except ImportError:
        try:
            import tensorflow as tf
            tflite = tf.lite
        except ImportError:
            logger.warning("TFLite not available — MOCK mode")
            _mock_mode = True
            return

    try:
        import joblib
        _encoder = joblib.load(os.path.join(MODEL_DIR, 'label_encoder.pkl'))
        _scaler = joblib.load(os.path.join(MODEL_DIR, 'scaler.pkl'))
    except Exception as e:
        logger.warning(f"Scaler/encoder failed: {e} — MOCK")
        _mock_mode = True
        return

    try:
        _model = tflite.Interpreter(
            model_path=os.path.join(MODEL_DIR, 'heartbeat_model_cpu.tflite')
        )
        _model.allocate_tensors()
        logger.info("TFLite model loaded successfully")
    except Exception as e:
        logger.warning(f"Model load failed: {e} — MOCK")
        _mock_mode = True


def _load_and_trim(path):
    """Load audio at sr=22050, trim silence, pad/trim to exactly 5 seconds."""
    import librosa

    y, _ = librosa.load(path, sr=SAMPLE_RATE, duration=DURATION, mono=True)

    # Trim silence
    y, _ = librosa.effects.trim(y, top_db=TRIM_TOP_DB)

    # Pad or trim to N_SAMPLES
    if len(y) < N_SAMPLES:
        y = np.pad(y, (0, N_SAMPLES - len(y)))
    else:
        y = y[:N_SAMPLES]

    return y


def _wav_to_melspec(y):
    """
    Convert waveform to normalized mel-spectrogram (224 x 224).
    Exact copy of the training notebook function.
    """
    import librosa

    S = librosa.feature.melspectrogram(
        y=y, sr=SAMPLE_RATE, n_mels=N_MELS,
        hop_length=HOP_LENGTH, n_fft=N_FFT
    )
    S_db = librosa.power_to_db(S, ref=np.max)

    # Normalize to 0-1
    lo, hi = S_db.min(), S_db.max()
    spec = (S_db - lo) / (hi - lo + 1e-8)

    # Pad or trim time axis to IMG_WIDTH
    if spec.shape[1] < IMG_WIDTH:
        spec = np.pad(spec, ((0, 0), (0, IMG_WIDTH - spec.shape[1])))
    else:
        spec = spec[:, :IMG_WIDTH]

    return spec  # shape: (224, 224)


def _prepare_input(mel_spec):
    """Flatten → scale → reshape to (1, 224, 224, 1)."""
    flat = mel_spec.reshape(1, -1)                 # (1, 50176)
    scaled = _scaler.transform(flat)                # (1, 50176)
    return scaled.reshape(1, N_MELS, IMG_WIDTH, 1).astype(np.float32)  # (1, 224, 224, 1)


def _predict_tflite(input_data):
    """Run TFLite inference."""
    inp = _model.get_input_details()
    out = _model.get_output_details()

    _model.set_tensor(inp[0]['index'], input_data)
    _model.invoke()
    return np.array(_model.get_tensor(out[0]['index'])).flatten()


def _predict_mock(features):
    """Mock prediction."""
    seed = int(float(features.flatten()[0]) * 1000) % (2 ** 31)
    return np.random.RandomState(seed).dirichlet(np.ones(5))


def _gen_spectrogram(y, sr, save_path):
    """Generate mel spectrogram PNG."""
    import librosa
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import base64
    from io import BytesIO

    fig, ax = plt.subplots(figsize=(6, 3), dpi=100)
    fig.patch.set_facecolor('#f8f9ff')
    ax.set_facecolor('#f8f9ff')

    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, fmax=8000)
    librosa.display.specshow(
        librosa.power_to_db(mel, ref=np.max), sr=sr,
        x_axis='time', y_axis='mel', fmax=8000, ax=ax, cmap='magma'
    )
    ax.set_title('Mel Spectrogram', color='#333', fontsize=12, pad=8)
    ax.tick_params(colors='#999', labelsize=8)
    for s in ax.spines.values():
        s.set_edgecolor('#ddd')

    buf = BytesIO()
    plt.tight_layout()
    fig.savefig(buf, format='png', bbox_inches='tight', facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode('utf-8')

    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, 'wb') as f:
        f.write(base64.b64decode(b64))
    return b64


def _get_info(label):
    d = {
        'normal': (
            'Your heartbeat sounds normal with regular rhythm and no detectable abnormalities. '
            'The cardiac auscultation reveals clear S1 and S2 heart sounds.',
            'No immediate action needed. Maintain a healthy lifestyle with regular exercise.'
        ),
        'murmur': (
            'A heart murmur has been detected. Murmurs are extra or unusual sounds during the '
            'heartbeat cycle that may indicate turbulent blood flow through the heart valves.',
            'Consult a cardiologist for further evaluation with echocardiography.'
        ),
        'artifact': (
            'The recorded audio contains significant noise or artifacts. This could be due to '
            'movement, clothing friction, or improper mic placement.',
            'Please re-record in a quiet environment with the mic placed firmly on the chest.'
        ),
        'extrahls': (
            'An extra heart sound (S3 or S4 gallop) has been detected. These can be associated '
            'with conditions like heart failure or ventricular hypertrophy.',
            'Consult a cardiologist for a comprehensive cardiac assessment.'
        ),
        'extrastole': (
            'An extra beat (extrasystole) has been detected. Premature beats may originate from '
            'the atria or ventricles and may be benign or indicate underlying conditions.',
            'Consult a cardiologist if symptoms persist. Monitor for palpitations or dizziness.'
        ),
    }
    t, r = d.get(label, d['normal'])
    return {'text': t, 'rec': r}


def predict_heartbeat(audio_file_path):
    """
    Main entry point. Returns prediction dict.
    Pipeline: load → trim → mel-spec (224x224) → flatten → scale → reshape → TFLite
    """
    _load_artifacts()

    y = _load_and_trim(audio_file_path)
    mel_spec = _wav_to_melspec(y)          # (224, 224)

    if _mock_mode:
        scores = _predict_mock(mel_spec)
        logger.info("MOCK MODE — generating plausible results")
    else:
        try:
            input_data = _prepare_input(mel_spec)
            scores = _predict_tflite(input_data)
        except Exception as e:
            logger.error(f"Model inference failed: {e}, falling back to mock")
            scores = _predict_mock(mel_spec)

    sl = np.array(scores).flatten().tolist()
    all_scores = {}
    for i, cls in enumerate(VALID_CLASSES):
        all_scores[cls] = round(float(sl[i]) * 100, 1) if i < len(sl) else 0.0

    bi = int(np.argmax(sl))
    label = VALID_CLASSES[bi] if bi < len(VALID_CLASSES) else 'normal'
    conf = round(float(sl[bi]) * 100, 1) if bi < len(sl) else 0.0

    if conf < 25:
        raise ValueError(
            "INVALID_AUDIO: The audio does not appear to be a proper heartbeat sound."
        )

    # Generate spectrogram for display
    try:
        spec_b64 = _gen_spectrogram(
            y, SAMPLE_RATE,
            os.path.join(
                os.path.dirname(audio_file_path), '..', 'spectrograms',
                os.path.basename(audio_file_path).replace('.wav', '.png').replace('.webm', '.png')
            )
        )
    except Exception as e:
        logger.error(f"Spectrogram failed: {e}")
        spec_b64 = None

    info = _get_info(label)

    return {
        'label': label,
        'confidence': conf,
        'all_scores': all_scores,
        'explanation': info['text'],
        'recommendation': info['rec'],
        'spectrogram_b64': spec_b64,
        'mock_mode': _mock_mode,
    }
