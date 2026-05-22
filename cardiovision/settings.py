"""
Django settings for CardioVision
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'cardiovision-2025-secure-change-me-x9$k2m'
DEBUG = True
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    'analyzer',
]
MIDDLEWARE = ['django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'cardiovision.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'templates'],
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.debug',
            'django.template.context_processors.static',
        ],
    },
}]

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')
STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_DIRS = [os.path.join(BASE_DIR, 'static')]
DATABASES = {}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
MODEL_DIR = os.path.join(BASE_DIR, 'models')
HISTORY_FILE = os.path.join(BASE_DIR, 'data', 'history.json')
