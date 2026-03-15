import os
import sys
import subprocess

venv_path = r"c:\Users\ADWAITH\Documents\Sales Forcasting\ProphetBased\.venv\Scripts\python.exe"

print(f"--- Environment Diagnostic ---")
print(f"1. File exists: {os.path.exists(venv_path)}")

if os.path.exists(venv_path):
    print(f"2. File is executable: {os.access(venv_path, os.X_OK)}")
    try:
        version = subprocess.check_output([venv_path, "--version"], text=True)
        print(f"3. Internal Python Version: {version.strip()}")
    except Exception as e:
        print(f"3. Execution Failed: {e}")
else:
    print("CRITICAL: The path does not exist. You may need to recreate the venv.")