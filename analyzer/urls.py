"""Analyzer app URL routes"""
from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('upload_analyze/', views.upload_analyze, name='upload_analyze'),
    path('history/', views.get_history, name='history'),
    path('delete_audio/', views.delete_audio, name='delete_audio'),
]
