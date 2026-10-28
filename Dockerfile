FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY vezerlo-auth.sh /docker-entrypoint.d/40-vezerlo-auth.sh
RUN chmod +x /docker-entrypoint.d/40-vezerlo-auth.sh
COPY site/ /usr/share/nginx/html/
COPY vezerlo/ /usr/share/nginx/html/vezerlo/
COPY kiadas.json /usr/share/nginx/html/vezerlo/kiadas.json
EXPOSE 80
