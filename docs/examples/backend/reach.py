import socket
import sys

for target in sys.argv[1:]:
    host, port = target.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(port)), timeout=3):
            print(f"{target}: open")
    except OSError as error:
        print(f"{target}: closed ({type(error).__name__})")
