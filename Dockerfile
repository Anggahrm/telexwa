FROM node:lts-buster

RUN apt-get update && \
  apt-get upgrade -y && \
  rm -rf /var/lib/apt/lists/*

COPY /telegram/whatsapp/manager/package.json .

RUN npm install

COPY . .

EXPOSE 5000

CMD ["node", "index.js"]
