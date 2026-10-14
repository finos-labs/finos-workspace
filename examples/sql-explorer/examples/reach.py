"""Prints which host:port pairs a container can open a TCP connection to.

    docker exec -i <container> python - host:port ... < examples/reach.py

Checks the example's networks: the backend reaches its Postgres and nothing else.
"""

import socket
import sys

for target in sys.argv[1:]:
    host, port = target.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(port)), timeout=3):
            print(f"{target}: open")
    except OSError as error:
        print(f"{target}: closed ({type(error).__name__})")
