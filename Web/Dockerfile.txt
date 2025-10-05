# Use multi-stage build
FROM php:8.0-apache AS php-stage
WORKDIR /var/www/html
COPY Web/back-end.php .
RUN chmod 755 back-end.php

FROM node:18 AS node-stage
WORKDIR /app
COPY Bot /app/Bot
WORKDIR /app/Bot
RUN npm install

# Final stage
FROM php:8.0-apache
WORKDIR /app

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Node.js app
COPY --from=node-stage /app .

# Copy PHP backend
COPY --from=php-stage /var/www/html/back-end.php .

# Configure Apache
COPY apache-config.conf /etc/apache2/sites-available/000-default.conf
RUN a2enmod rewrite

# Fix line endings
COPY start.sh .
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

CMD ["./start.sh"]