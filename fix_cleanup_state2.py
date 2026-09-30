import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

bad_state = """        # Update sync state
        state["synced_movie_ids"] = list(current_ids)
        state["latest_watched_at"] = max_watched_at
        state["last_sync_time"] = datetime.now().isoformat()
        state["total_synced"] = len(current_ids)
        save_sync_state(state)"""

good_state = """        # Update sync state
        state["synced_movie_ids"] = list(current_ids)
        state["latest_watched_at"] = max_watched_at
        state["last_sync_time"] = datetime.now().isoformat()
        state["total_synced"] = len(current_ids)
        if cleanup_candidates:
            state["last_synced_movies"] = [m.get("movie", {}).get("ids", {}).get("tmdb") for m in cleanup_candidates]
        save_sync_state(state)"""

if bad_state in content:
    content = content.replace(bad_state, good_state)
    print("Patched state saving!")
else:
    print("Could not patch state saving! Doing regex fallback.")
    content = re.sub(r'(state\["total_synced"\] = len\(current_ids\)\s+)save_sync_state\(state\)', r'\1if cleanup_candidates:\n            state["last_synced_movies"] = [m.get("movie", {}).get("ids", {}).get("tmdb") for m in cleanup_candidates]\n        save_sync_state(state)', content)

with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
    f.write(content)
