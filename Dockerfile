# Use the official Node.js image as the base image
FROM node:18

# Install ffmpeg 
RUN apt-get update && apt-get install -y ffmpeg

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Command to run the application
CMD ["node", "index.js"]
