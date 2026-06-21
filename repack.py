import os
import zipfile

source_dir = './model/best'
output_pt = './model/best1.pt'

# Ensure the output directory exists
os.makedirs(os.path.dirname(output_pt), exist_ok=True)

# Standard root folder name inside PyTorch zip files is usually 'archive' 
# or matching the original file name. We will try 'archive' first, and fallback if needed.
root_in_zip = 'archive'

print(f"[*] Repacking PyTorch components from '{source_dir}' into '{output_pt}'...")

try:
    # 1. Zip the folder files under the root_in_zip folder prefix
    with zipfile.ZipFile(output_pt, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                full_path = os.path.join(root, file)
                # Compute relative path from the unzipped model directory
                rel_path = os.path.relpath(full_path, source_dir)
                # Normalize separator to forward slashes for ZIP standards
                rel_path_zip = rel_path.replace(os.sep, '/')
                # Write inside the ZIP under the prefix directory
                zip_path = f"{root_in_zip}/{rel_path_zip}"
                zipf.write(full_path, zip_path)
                
    print(f"[+] Successfully repacked files into '{output_pt}'")
    
    # 2. Verify if the file is readable by the Ultralytics YOLO loader
    print("[*] Verifying if YOLO can parse the repacked file...")
    try:
        from ultralytics import YOLO
        model = YOLO(output_pt, task='classify')
        print("[+] SUCCESS: The repacked model loaded successfully in YOLOv8!")
    except Exception as verify_err:
        print(f"[-] Verification load failed with prefix '{root_in_zip}': {verify_err}")
        print("[*] Retrying repack using directory name 'best' as the root prefix in ZIP...")
        
        # Retry with prefix 'best'
        root_in_zip_alt = 'best'
        with zipfile.ZipFile(output_pt, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, source_dir)
                    rel_path_zip = rel_path.replace(os.sep, '/')
                    zip_path = f"{root_in_zip_alt}/{rel_path_zip}"
                    zipf.write(full_path, zip_path)
                    
        # Verify again
        try:
            from ultralytics import YOLO
            model = YOLO(output_pt, task='classify')
            print("[+] SUCCESS: The repacked model loaded successfully in YOLOv8 with 'best' root prefix!")
        except Exception as verify_err_alt:
            print(f"[-] Verification failed again with 'best' prefix: {verify_err_alt}")
            print("[-] Please ensure that all unzipped PyTorch metadata files are present in the folder.")

except Exception as repack_err:
    print(f"[-] Failed to repack files: {repack_err}")
