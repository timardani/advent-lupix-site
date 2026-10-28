FROM nginx:1.27-alpine
RUN apk add --no-cache openssl python3
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY vezerlo-auth.sh /docker-entrypoint.d/40-vezerlo-auth.sh
COPY start.sh /app/start.sh
COPY vezerlo-api.py /app/vezerlo-api.py
COPY vezerlo/adat.json /app-seed/adat.json
RUN chmod +x /docker-entrypoint.d/40-vezerlo-auth.sh /app/start.sh
COPY site/ /usr/share/nginx/html/
COPY vezerlo/ /usr/share/nginx/html/vezerlo/
COPY belepes/ /usr/share/nginx/html/belepes/
COPY kiadas.json /usr/share/nginx/html/vezerlo/kiadas.json
VOLUME ["/data"]
EXPOSE 80
CMD ["/app/start.sh"]
