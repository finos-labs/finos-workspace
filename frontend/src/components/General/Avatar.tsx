import { cva, type VariantProps } from "class-variance-authority";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { type QueryOptions, type TResponseCb, useJsonData } from "~/lib/api";
import {
  type Source,
  useShallowBackendConnectorStore,
  useSourceCredentials,
} from "~/lib/state/backendConnector";
import { createURLString } from "~/lib/utils/widgetParams";
import { plainRequest } from "~/lib/utils/widgetRequest";
import { cn } from "../ds/utils";

const avatarVariants = cva(
  [
    "BB-Avatar relative flex aspect-square shrink-0 overflow-hidden rounded-full",
    "bg-transparent dark:text-white text-black",
  ],
  {
    variants: {
      variant: {
        xs: "subtitle-2xs-medium w-6",
        sm: "body-xs-medium w-8",
        md: "subtitle-sm-medium w-10",
        lg: "subtitle-md-medium w-12",
        noVariant: "",
      },
    },
    defaultVariants: {
      variant: "sm",
    },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  src?: string;
  alt: string;
  fallback?: ReactNode;
  className?: string;
  size?: number;
  extraClassName?: string;
  withVariantCva?: boolean;
  imageClassName?: string;
  onError?: () => void;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  cacheKey?: string;
}

function alternativeText(alt: string) {
  if (!alt || typeof alt !== "string") return;
  const words = alt.trim().split(" ");
  if (words.length === 1) return alt.slice(0, 2).toUpperCase();

  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// The image types base64 data is recognised by, from the start of its encoding
const BASE64_IMAGE_TYPES: [prefix: string, type: string][] = [
  ["iVBORw0KGgo", "image/png"],
  ["/9j/", "image/jpeg"],
  ["R0lGOD", "image/gif"],
  ["UklGR", "image/webp"],
  ["PHN2Zy", "image/svg+xml"],
  ["PD94bWwg", "image/svg+xml"],
  ["AAABAA", "image/x-icon"],
];

/** The data URI of `text` when it is an image's base64 data. */
function base64ImageUri(text: string) {
  const data = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined;
  const type = BASE64_IMAGE_TYPES.find(([prefix]) => data.startsWith(prefix))?.[1];
  return type ? `data:${type};base64,${data}` : undefined;
}

// The image a response carries: an image file, or sent as text, an SVG, a data URI or
// base64 data. The body is read once.
const responseCb: TResponseCb<string> = async (response, resolve, reject) => {
  try {
    const blob = await response.blob();
    const contentType = response.headers.get("content-type") || blob.type;

    if (contentType.includes("text") || contentType.includes("application/json")) {
      const text = (await blob.text()).trim();
      if (text.startsWith("data:")) return resolve(text);
      const base64 = base64ImageUri(text);
      if (base64) return resolve(base64);
      if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
        return resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
      }
      return reject(new Error("Failed to load image"));
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  } catch (err) {
    reject("Failed to load image");
  }
};

export const Avatar = memo((props: AvatarProps) => {
  const {
    src,
    alt,
    withVariantCva = true,
    variant,
    size = 24,
    className = "inline-flex items-center justify-center rounded-[2px]",
    extraClassName = "",
    imageClassName = "",
    fallback,
    headers,
    params,
    cacheKey = src ?? "",
  } = props;

  // A data URI, or a path on the Workspace itself, is shown as it is
  const isInline = !!src && (src.startsWith("data:") || src.startsWith("/"));
  // An image that needs a data backend's credentials comes only through the request that
  // carries them
  const needsCredentials =
    Object.keys(headers ?? {}).length + Object.keys(params ?? {}).length > 0;
  const [failedSrc, setFailedSrc] = useState<string>();

  const queryOptions = useMemo<QueryOptions<string>>(
    () => ({
      request: src
        ? plainRequest(src, { headers: headers ?? {}, query: params ?? {} })
        : null,
      // By the credentials' names, never their values: the image is fetched again when
      // its backend's credentials arrive
      queryKey: [cacheKey, Object.keys(headers ?? {}), Object.keys(params ?? {})],
      responseCb,
    }),
    [src, headers, params, cacheKey],
  );

  const { data, isError } = useJsonData<string>(queryOptions, {
    enabled: !!src && !isInline,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    retry: false,
    // An image that failed is not asked for again while the page is open
    retryOnMount: false,
  });

  // The fetched image. Until it arrives, a public image is shown from its address; one
  // that needs credentials is not, before its fetch has failed. A page cannot fetch an
  // image from a host that does not share it, which an <img> still shows.
  const shownSrc = isInline
    ? src
    : (data ?? (needsCredentials && !isError ? undefined : src));
  const showImage = !!shownSrc && shownSrc !== failedSrc;

  const onError = useCallback(() => {
    setFailedSrc(shownSrc);
    if (props.onError) props.onError();
  }, [shownSrc, props.onError]);

  return (
    <span
      style={
        withVariantCva && size && !variant ? { width: size, height: size } : undefined
      }
      className={cn(
        withVariantCva && avatarVariants({ variant }),
        className,
        extraClassName,
      )}
      data-testid="avatar"
    >
      {showImage ? (
        <img
          src={shownSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          className={imageClassName}
          onError={onError}
        />
      ) : (
        (fallback ?? alternativeText(alt))
      )}
    </span>
  );
});

interface AuthenticatedAvatar
  extends Omit<
    AvatarProps,
    "imageClassName" | "withVariantCva" | "headers" | "params" | "variant" | "size"
  > {
  source?: Source;
}

export const AuthenticatedAvatar = memo<AuthenticatedAvatar>((props) => {
  const { src, source, className, ...rest } = props;

  // An app's image: an address, a path on its data backend (such as the backend's
  // `/thumbnails/{name}`), or the image itself as a data URI or base64 data
  const url = useMemo(() => {
    const value = src?.trim();
    if (!value) return undefined;
    if (/^(data:|https?:\/\/)/i.test(value)) return value;
    const base64 = base64ImageUri(value);
    if (base64) return base64;
    return source?.url ? createURLString(value, source.url) : value;
  }, [src, source?.url]);

  // The backend's credentials go with an image on its origin only: its headers, and its
  // query rows as parameters of the request, never in the image's address. Until the
  // backends are loaded they are not known, and the image waits for them.
  const credentials = useSourceCredentials(source?.id, url);
  const sourcesLoaded = useShallowBackendConnectorStore((state) => state.sourcesLoaded);
  const waiting = !!source?.url && !sourcesLoaded;

  return (
    <Avatar
      {...rest}
      className="w-full h-full rounded-none!"
      imageClassName={className}
      src={waiting ? undefined : url}
      headers={credentials.headers}
      params={credentials.query}
      withVariantCva={false}
      cacheKey={url?.startsWith("data:") ? `${source?.uuid}-${rest.alt}` : url}
    />
  );
});

export default Avatar;
