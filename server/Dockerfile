FROM python:3.11-slim

# Install system dependencies including ffmpeg and nodejs (for yt-dlp JS runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    npm \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependencies first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Ensure downloads directory exists
RUN mkdir -p /app/downloads

# Expose port (Hugging Face Spaces uses 7860, Render uses 10000 or PORT env var)
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
