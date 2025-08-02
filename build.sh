#!/bin/sh

cd client && docker build -f Dockerfile.production . -t medformatik/your_tidal_client:latest ; cd -
cd server && docker build -f Dockerfile.production . -t medformatik/your_tidal_server:latest ; cd -