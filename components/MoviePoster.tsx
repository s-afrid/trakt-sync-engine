"use client";

import React, { useState } from "react";
import { Film, Tv, Sparkles } from "lucide-react";

interface MoviePosterProps {
  src?: string;
  title: string;
  year?: number | string;
  platform?: "letterboxd" | "myanimelist" | "trakt" | "system";
  type?: "movie" | "episode" | "completed" | "sync_run" | "show" | "anime";
  className?: string;
  aspect?: "poster" | "backdrop" | "square";
}

export default function MoviePoster({
  src,
  title,
  year,
  platform = "letterboxd",
  type = "movie",
  className = "",
  aspect = "poster",
}: MoviePosterProps) {
  const [hasError, setHasError] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Normalize image URL
  let resolvedUrl: string | undefined = undefined;
  if (src && !hasError) {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      resolvedUrl = src;
    } else if (src.startsWith("//")) {
      resolvedUrl = `https:${src}`;
    } else if (src.startsWith("media.trakt.tv") || src.startsWith("image.tmdb.org") || src.startsWith("a.ltrbxd.com")) {
      resolvedUrl = `https://${src}`;
    } else {
      resolvedUrl = src;
    }
  }

  const isEpisode = type === "episode";
  const aspectClass =
    aspect === "square"
      ? "aspect-square"
      : aspect === "backdrop"
      ? "aspect-[16/9]"
      : "aspect-[2/3]";

  if (!resolvedUrl || hasError) {
    // Elegant Cinematic Fallback Card (Haulix obsidian aesthetic)
    return (
      <div
        className={`relative rounded-xl overflow-hidden bg-gradient-to-br from-elevated via-surface to-canvas border border-edge flex flex-col items-center justify-between p-2 select-none shadow-md shrink-0 ${aspectClass} ${className}`}
        title={`${title} ${year ? `(${year})` : ""}`}
      >
        <div className="w-full flex items-center justify-between opacity-50">
          <span className="text-[9px] font-mono tracking-wider uppercase text-ink-muted">
            {platform === "myanimelist"
              ? "MAL"
              : platform === "letterboxd"
              ? "FILM"
              : platform === "trakt"
              ? "TRAKT"
              : "SYNC"}
          </span>
          {isEpisode ? (
            <Tv className="h-3 w-3 text-accent" />
          ) : (
            <Film className="h-3 w-3 text-success" />
          )}
        </div>

        <div className="text-center px-1 my-auto">
          <p className="text-[11px] font-bold text-ink line-clamp-2 leading-tight">
            {title}
          </p>
          {year && (
            <p className="text-[9px] font-medium text-ink-muted mt-0.5 font-mono">
              {year}
            </p>
          )}
        </div>

        <div className="w-full h-1 rounded-full bg-ink/10 overflow-hidden">
          <div
            className={`h-full w-2/3 ${
              platform === "myanimelist"
                ? "bg-accent/40"
                : platform === "letterboxd"
                ? "bg-success/40"
                : platform === "trakt"
                ? "bg-danger/40"
                : "bg-accent/40"
            }`}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-canvas border border-edge shadow-md shadow-black/40 group shrink-0 ${aspectClass} ${className}`}
    >
      {/* Skeleton / Shimmer while loading */}
      {!loaded && (
        <div className="absolute inset-0 bg-surface/80 animate-pulse flex items-center justify-center">
          <Film className="h-4 w-4 text-ink-subtle" />
        </div>
      )}

      {/* Actual Poster Image */}
      <img
        src={resolvedUrl}
        alt={title}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setHasError(true)}
        className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Subtle Bottom Ambient Gradient for text legibility */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-canvas/80 via-canvas/20 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
    </div>
  );
}
