"use client";

import Image from "next/image";
import { useState } from "react";
import type { Category } from "@/generated/prisma/enums";
import { CATEGORIES } from "@/lib/categories";
import { CategoryIcon } from "./category-icon";

/**
 * Viñeta ovalada del título: la foto del activo o, si no hay o no carga, el emblema de la
 * categoría grabado en su tinta.
 */
export function Vignette({
  image,
  category,
  alt,
  sizes,
  priority = false,
}: {
  image?: string;
  category: Category;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const { ink, inkSoft } = CATEGORIES[category];
  const showImage = Boolean(image) && !failed;

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[50%]"
      style={{ boxShadow: `0 0 0 3px ${inkSoft}, 0 0 0 4px ${ink}66, 0 0 0 7px ${inkSoft}, 0 0 0 7.6px ${ink}40` }}
    >
      {showImage ? (
        <Image
          src={image!}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: `radial-gradient(circle at 50% 42%, #ffffff 0%, ${inkSoft} 78%)` }}
        >
          <CategoryIcon category={category} className="h-[34%] w-[34%]" strokeWidth={1.25} style={{ color: ink }} />
        </div>
      )}
    </div>
  );
}
