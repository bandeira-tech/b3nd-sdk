FROM nginx:stable-alpine

# Custom nginx configuration to serve the built app on port 8080
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy pre-built assets (run your build locally to populate dist/)
COPY dist/ /usr/share/nginx/html/

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
