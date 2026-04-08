import base64
import zlib
import urllib.request
import os
from PIL import Image

def generate_plantuml(puml_code, output_file):
    # Compress the PlantUML code
    compressed = zlib.compress(puml_code.encode('utf-8'), 9)
    # URL safe base64 encode
    b64 = base64.urlsafe_b64encode(compressed).decode('ascii')
    
    # We switch the Kroki endpoint to target the PlantUML engine instead of Mermaid!
    url = f"https://kroki.io/plantuml/png/{b64}"
    print(f"Downloading {output_file} from PlantUML Engine...")
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(output_file, 'wb') as out_file:
            out_file.write(response.read())
        
        # Open the image with Pillow and force a solid white background
        img = Image.open(output_file)
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            white_bg = Image.new("RGB", img.size, (255, 255, 255))
            img_rgba = img.convert('RGBA')
            white_bg.paste(img_rgba, mask=img_rgba.split()[3])
            white_bg.save(output_file, "PNG")

        print(f"Success: Saved {output_file} with stickmen actors.")
    except Exception as e:
        print(f"Failed to download or process {output_file}: {e}")

# High-fidelity PlantUML syntax which guarantees stick figures for actors and formal oval bounds for use cases
use_case_plantuml = """
@startuml
skinparam backgroundcolor white
skinparam usecase {
  BackgroundColor white
  BorderColor black
}
skinparam actor {
  BackgroundColor white
  BorderColor black
}

left to right direction

actor "Business Analyst" as Analyst
actor "Procurement Manager" as Manager

actor "Market Data API" as ExtAPI << External >>

package "Sales & Supply Chain System" {
  usecase "View Dashboard KPIs" as UC1
  usecase "Analyze Forecasts" as UC2
  usecase "Calculate EOQ" as UC5
  usecase "Assess Stockout Risk" as UC6
  usecase "Draft Purchase Orders" as UC7
  usecase "Multi-Agent Chat" as UC9
  usecase "Semantic Search" as UC11
}

Analyst --> UC1
Analyst --> UC2
Analyst --> UC9

Manager --> UC1
Manager --> UC5
Manager --> UC6
Manager --> UC7
Manager --> UC9

UC5 -.-> ExtAPI
UC9 -.-> ExtAPI

@enduml
"""

print("Starting generation of proper Use Case diagram...")
generate_plantuml(use_case_plantuml, 'diagram_1_use_case.png')
print("Finished!")
