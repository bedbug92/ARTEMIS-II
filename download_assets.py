import urllib.request
import os

def download_file(url, filepath):
    print(f"Downloading {url} to {filepath}...")
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, filepath)
        print("Success!")
    except Exception as e:
        print(f"Failed: {e}")

# Base URL for github raw content
base_url = "https://raw.githubusercontent.com/fajrulfx/artemis-ii/main"

# Files to download
files = {
    f"{base_url}/web/trajectory.js": "src/data/trajectory.js",
    f"{base_url}/web/index.html": "scratch/index_ref.html",
    f"{base_url}/web/simulation.html": "scratch/simulation_ref.html",
    f"{base_url}/web/orion.stl": "public/orion.stl",
}

for url, path in files.items():
    download_file(url, path)
