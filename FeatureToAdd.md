1. if the site do not have ineternet access, do not try to search the web
2. add need rechunk option for book (on listing), add a "rechunk marked book" in chunk tab, which will manual add a rechunk sweeper job to the queue to run soon.
3. when sync with jopline, only upload the chunk if changed. (add front matter to the chunks, and add a body checksum there, from now on if the checksum is not equal or checksum missing, remove the old and upload the chunk, otherwise, do not upload)
