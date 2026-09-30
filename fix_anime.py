import re

with open('lib/sync/anime-sync.ts', 'r', encoding='utf-8') as f:
    content = f.read()

bad_isCompleted = """      const isCompleted =
        totalMalEpisodes > 0 &&
        (maxEpisodeWatched >= totalMalEpisodes ||
          uniqueEpisodesWatched >= totalMalEpisodes ||
          traktPlays >= totalMalEpisodes);

      let targetEpisodes = Math.max(maxEpisodeWatched, uniqueEpisodesWatched, traktPlays);"""

good_isCompleted = """      const isCompleted =
        totalMalEpisodes > 0 &&
        (maxEpisodeWatched >= totalMalEpisodes ||
          uniqueEpisodesWatched >= totalMalEpisodes);

      let targetEpisodes = Math.max(maxEpisodeWatched, uniqueEpisodesWatched);
      if (targetEpisodes === 0 && traktPlays > 0) {
        targetEpisodes = traktPlays > totalMalEpisodes && totalMalEpisodes > 0 ? totalMalEpisodes : traktPlays;
      }"""

if bad_isCompleted in content:
    content = content.replace(bad_isCompleted, good_isCompleted)
    with open('lib/sync/anime-sync.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed AnimeSyncService logic!")
else:
    print("Could not find AnimeSyncService logic to patch!")
