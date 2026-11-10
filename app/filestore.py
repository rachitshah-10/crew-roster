"""Original upload bytes, addressed by SHA-256 so repeated uploads share one copy.

LocalFileStore keeps files on disk. Another backend (e.g. object storage) only
needs the same put/get methods.
"""
import hashlib
import os
import secrets
from pathlib import Path


class LocalFileStore:
    def __init__(self, directory):
        self.directory = Path(directory)

    def path(self, digest):
        return self.directory / digest[:2] / digest

    def put(self, content):
        digest = hashlib.sha256(content).hexdigest()
        target = self.path(digest)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(f"{digest}.{secrets.token_hex(4)}.part")
            partial.write_bytes(content)
            os.replace(partial, target)
        return digest

    def get(self, digest):
        target = self.path(digest)
        return target.read_bytes() if target.is_file() else None
