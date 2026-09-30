import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

bad_arg = 'cleanup_movies=cleanup_candidates if (args.auto_confirm and getattr(args, "cleanup_watchlist", True)) else None,'
good_arg = 'cleanup_movies=cleanup_candidates if ((args.auto_confirm or getattr(args, "job", "all") == "cleanup") and getattr(args, "cleanup_watchlist", True)) else None,'

if bad_arg in content:
    content = content.replace(bad_arg, good_arg)
    with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed script successfully!")
else:
    print("Could not find line to patch!")
