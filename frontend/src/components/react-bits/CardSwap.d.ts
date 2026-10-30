import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes } from "react";

export interface CardSwapHandle { next(): void; prev(): void }
export interface CardSwapProps {
  children?: ReactNode;
  width?: number;
  height?: number;
  cardDistance?: number;
  verticalDistance?: number;
  depth?: number;
  skewAmount?: number;
  visibleCards?: number;
  delay?: number;
  autoplay?: boolean;
  pauseOnHover?: boolean;
  draggable?: boolean;
  speed?: number;
  bounce?: number;
  parallax?: number;
  hoverSpread?: number;
  dim?: number;
  cardRadius?: number;
  intro?: boolean;
  theme?: "dark" | "light";
  onCardClick?: (index: number) => void;
  onChange?: (index: number) => void;
  className?: string;
}
export const Card: ForwardRefExoticComponent<HTMLAttributes<HTMLDivElement> & { customClass?: string } & RefAttributes<HTMLDivElement>>;
declare const CardSwap: ForwardRefExoticComponent<CardSwapProps & RefAttributes<CardSwapHandle>>;
export default CardSwap;
