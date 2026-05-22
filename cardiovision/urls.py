"""Root URL configuration"""
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [path('', include('analyzer.urls'))]

# Serve media files (uploaded audio) in DEBUG mode
# Static files (CSS/JS) are auto-served by django.contrib.staticfiles via runserver
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
