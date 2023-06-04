import os
import re

# Get the current folder
folder_path = os.getcwd()

# Iterate over all files in the folder
for filename in os.listdir(folder_path):
    # Check if the file name contains "-min"
    if "-min" in filename:
        # Remove "-min" using regular expressions
        new_filename = re.sub(r"-min", "", filename)
        new_filepath = os.path.join(folder_path, new_filename)
        
        # Rename the file
        os.rename(os.path.join(folder_path, filename), new_filepath)
        print(f"Renamed: {filename} -> {new_filename}")
