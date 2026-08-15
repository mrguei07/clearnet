# CLEARNET - 80% CODEBASE BUNDLE (Monolithique)
# Version : MVP Strict | Supervision : Humain | Framework : Full-Stack DeFi

---

## SOMMAIRE DU BUNDLE
1. `/clearnet-backend` (NestJS 10 + Neo4j 5)
2. `/clearnet-blockchain` (Hardhat + Solidity 0.8.19)
3. `/clearnet-mobile` (React Native 0.72 + Expo)
4. `/infrastructure` (Docker Compose)
5. `README.md` (Instructions d'exécution)

---

# SECTION 1 : BACKEND (NestJS)

## Fichier : `clearnet-backend/package.json`
```json
{
  "name": "clearnet-backend",
  "version": "0.0.1",
  "description": "Moteur de compensation décentralisée - Backend",
  "main": "dist/main.js",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "bcrypt": "^5.1.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "neo4j-driver": "^5.8.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.2",
    "@types/node": "^20.3.1",
    "@types/passport-jwt": "^3.0.9",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "ts-loader": "^9.4.3",
    "ts-node": "^10.9.1",
    "typescript": "^5.1.3"
  }
}