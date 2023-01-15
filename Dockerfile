FROM node:14-alpine

WORKDIR /opt/mre

ENV PORT=80
ENV BASE_URL=http://grabbable.openode.dev/


COPY package*.json ./
RUN ["npm", "install", "--unsafe-perm"]

COPY tsconfig.json ./
COPY src ./src/
RUN ["npm", "run", "build-only"]

COPY public ./public/

EXPOSE 3901/tcp
CMD ["npm", "start"]
