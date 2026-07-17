FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn httpx pypdf python-multipart bcrypt pyotp

# Create data and upload directories
RUN mkdir -p /app/data /app/uploads

# Copy app files
COPY app.py .
COPY static/ static/

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]