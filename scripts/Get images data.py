import os
from PIL import Image

folder_path = "../images/fotos"

for filename in os.listdir(folder_path):

    if ".png" in filename or ".jpg" in filename:

        img = Image.open(folder_path + "/" + filename)

        print('["' + filename + '", ' + str(img.size[0]) + ', ' + str(img.size[1]) + '],')
