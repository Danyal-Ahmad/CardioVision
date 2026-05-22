"""
Analyzer views — upload, analyze, history management.
"""
import os, json, uuid, logging
from datetime import datetime
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .utils.predictor import predict_heartbeat

logger = logging.getLogger(__name__)

AUDIO_DIR = os.path.join(settings.MEDIA_ROOT, 'heartbeat_audio')
os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(os.path.join(settings.MEDIA_ROOT, 'spectrograms'), exist_ok=True)
os.makedirs(os.path.dirname(settings.HISTORY_FILE), exist_ok=True)

def _load_history():
    if os.path.exists(settings.HISTORY_FILE):
        try:
            with open(settings.HISTORY_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []

def _save_history(h):
    with open(settings.HISTORY_FILE, 'w') as f:
        json.dump(h, f, indent=2)

def _err(msg, s=400):
    return JsonResponse({'error': msg}, status=s)

def index(request):
    return render(request, 'analyzer/index.html')

@csrf_exempt
@require_http_methods(["POST"])
def upload_analyze(request):
    if 'audio' not in request.FILES:
        return _err("No audio file provided.")
    af = request.FILES['audio']
    if not af.content_type.startswith('audio/'):
        return _err("Please upload a proper heartbeat sound audio file. Supported formats: .wav, .mp3, .webm, .ogg. The audio must contain real heart sounds recorded from the chest — music, speech, or other audio will not work.")
    if af.size > 15 * 1024 * 1024:
        return _err("File too large. Maximum size is 15 MB.")

    ext = os.path.splitext(af.name)[1] or '.wav'
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    uid = str(uuid.uuid4())[:8]
    fname = f"cv_{ts}_{uid}{ext}"
    fpath = os.path.join(AUDIO_DIR, fname)

    with open(fpath, 'wb+') as f:
        for chunk in af.chunks():
            f.write(chunk)
    logger.info(f"Audio saved: {fname}")

    try:
        result = predict_heartbeat(fpath)
    except ValueError as e:
        os.remove(fpath)
        msg = str(e)
        if "INVALID_AUDIO" in msg:
            return JsonResponse({
                'error': 'The audio does not appear to be a proper heartbeat sound. Please record real heart sounds by placing the microphone firmly on the left side of your chest in a quiet room. Music, speech, or background noise will not produce valid results.',
                'detail': msg
            }, status=400)
        return _err(msg)
    except Exception as e:
        logger.error(f"Prediction failed: {e}", exc_info=True)
        return _err(f"Analysis failed: {str(e)}. Please ensure the audio contains real heartbeat sounds and try again.")

    aurl = f"{settings.MEDIA_URL}heartbeat_audio/{fname}"
    sfn = fname.replace('.wav', '.png').replace('.webm', '.png')
    surl = f"{settings.MEDIA_URL}spectrograms/{sfn}"

    entry = {
        'id': str(uuid.uuid4())[:12], 'filename': fname,
        'audio_url': aurl, 'spec_url': surl,
        'label': result['label'], 'confidence': result['confidence'],
        'all_scores': result['all_scores'],
        'explanation': result['explanation'], 'recommendation': result['recommendation'],
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    }
    history = _load_history()
    history.insert(0, entry)
    _save_history(history)

    return JsonResponse({
        'success': True, 'label': result['label'],
        'confidence': result['confidence'], 'all_scores': result['all_scores'],
        'explanation': result['explanation'], 'recommendation': result['recommendation'],
        'spectrogram_b64': result.get('spectrogram_b64'),
        'audio_url': aurl, 'spec_url': surl, 'filename': fname,
        'mock_mode': result.get('mock_mode', False), 'history': history,
    })

@csrf_exempt
@require_http_methods(["GET"])
def get_history(request):
    return JsonResponse({'history': _load_history()})

@csrf_exempt
@require_http_methods(["POST"])
def delete_audio(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("Invalid JSON.")
    eid, fn = data.get('id'), data.get('filename')
    if not eid or not fn:
        return _err("Missing id or filename.")
    history = [h for h in _load_history() if h.get('id') != eid]
    _save_history(history)
    p = os.path.join(AUDIO_DIR, fn)
    if os.path.exists(p): os.remove(p)
    sp = os.path.join(settings.MEDIA_ROOT, 'spectrograms', fn.replace('.wav','.png').replace('.webm','.png'))
    if os.path.exists(sp): os.remove(sp)
    return JsonResponse({'success': True})
