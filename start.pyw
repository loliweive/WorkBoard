import os
import subprocess
import time
import webbrowser

os.chdir(os.path.dirname(os.path.abspath(__file__)))
subprocess.Popen(["python", "server.py"])
time.sleep(1.5)
webbrowser.open("http://localhost:8765")
