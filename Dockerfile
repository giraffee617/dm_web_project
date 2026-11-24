# Dockerfile: the website + forecast API in one small container.
# Works on Render and on Hugging Face Spaces. Build and run locally with:
#   docker build -t ub-forecast .
#   docker run -p 7860:7860 ub-forecast        then open http://localhost:7860

# Same Python as development (.python-version), pinned to an exact release.
FROM python:3.14.6-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Run as a normal user (id 1000), not root. Hugging Face requires this, and it
# is safer everywhere. The app folder belongs to this user, so the server can
# write its daily forecast cache (cache/).
RUN useradd --create-home --uid 1000 app
WORKDIR /app

# 1. Packages first: this layer is rebuilt only when the requirements change.
#    requirements-serve.txt holds only what the server needs (no LightGBM,
#    XGBoost or SHAP), at exactly the versions in requirements.txt.
COPY --chown=app:app requirements-serve.txt .
RUN pip install --no-deps -r requirements-serve.txt

# 2. The code, the final models and the website. Training data, Optuna
#    history and reports are not needed to serve (see .dockerignore).
COPY --chown=app:app src/ src/
COPY --chown=app:app app/ app/
COPY --chown=app:app models/meta.json models/normals.json models/selected_features.json models/*.cbm models/
COPY --chown=app:app static/ static/

USER app

# Hugging Face uses port 7860. Render sets its own port in $PORT.
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
