#!/bin/bash

# Development server management script

PORT=${PORT:-3000}

# Function to kill process on port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port)
    if [ ! -z "$pid" ]; then
        echo "🔄 Killing existing process on port $port (PID: $pid)"
        kill -9 $pid
        sleep 1
    else
        echo "✅ No process running on port $port"
    fi
}

# Function to start development server
start_dev() {
    echo "🚀 Starting development server on port $PORT..."
    npm run start:dev
}

# Function to check if port is in use
check_port() {
    local port=$1
    local pid=$(lsof -ti:$port)
    if [ ! -z "$pid" ]; then
        echo "⚠️  Port $port is in use by process $pid"
        return 1
    else
        echo "✅ Port $port is available"
        return 0
    fi
}

# Main script logic
case "${1:-start}" in
    "start")
        if ! check_port $PORT; then
            echo "🔄 Attempting to free port $PORT..."
            kill_port $PORT
        fi
        start_dev
        ;;
    "kill")
        kill_port $PORT
        ;;
    "check")
        check_port $PORT
        ;;
    "restart")
        echo "🔄 Restarting development server..."
        kill_port $PORT
        sleep 2
        start_dev
        ;;
    *)
        echo "Usage: $0 {start|kill|check|restart}"
        echo "  start   - Start development server (default)"
        echo "  kill    - Kill process on port $PORT"
        echo "  check   - Check if port $PORT is in use"
        echo "  restart - Kill and restart development server"
        exit 1
        ;;
esac
