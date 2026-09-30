import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Save last_synced_movies to state
bad_state = """        if success:
            # Update sync state
            state["synced_movie_ids"] = list(current_ids)
            state["latest_watched_at"] = max_watched_at
            state["last_sync_time"] = datetime.now().isoformat()
            state["total_synced"] = len(current_ids)
            save_sync_state(state)"""

good_state = """        if success:
            # Update sync state
            state["synced_movie_ids"] = list(current_ids)
            state["latest_watched_at"] = max_watched_at
            state["last_sync_time"] = datetime.now().isoformat()
            state["total_synced"] = len(current_ids)
            # Persist the newly synced batch so isolated cleanup jobs know exactly what to target
            if cleanup_candidates:
                state["last_synced_movies"] = [m.get("movie", {}).get("ids", {}).get("tmdb") for m in cleanup_candidates]
            save_sync_state(state)"""

if bad_state in content:
    content = content.replace(bad_state, good_state)
    print("Patched state saving!")
else:
    print("Could not patch state saving!")

# 2. Retrieve last_synced_movies if new_movies is empty
bad_cleanup_cands = '    cleanup_candidates = new_movies if new_movies else (movies[:1] if movies else [])'

good_cleanup_cands = """    cleanup_candidates = new_movies
    if not cleanup_candidates:
        # If running as an isolated --job cleanup after state was already saved, retrieve the targeted batch
        last_synced = state.get("last_synced_movies", [])
        if last_synced:
            cleanup_candidates = [m for m in movies if m.get("movie", {}).get("ids", {}).get("tmdb") in last_synced]
        if not cleanup_candidates:
            cleanup_candidates = movies[:1] if movies else []"""

if bad_cleanup_cands in content:
    content = content.replace(bad_cleanup_cands, good_cleanup_cands)
    print("Patched cleanup candidates!")
else:
    print("Could not patch cleanup candidates!")

with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
    f.write(content)
