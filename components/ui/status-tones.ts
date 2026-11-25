// Explicit foreground/surface pairs keep small labels legible on both themes.
export const statusTones = {
  neutral:
    "border-[#cdd5df] bg-[#eef1f5] text-[#3c4b60] dark:border-[#425065] dark:bg-[#28313e] dark:text-[#d0dae7]",
  positive:
    "border-[#a6d9bd] bg-[#e5f6eb] text-[#165837] dark:border-[#31634b] dark:bg-[#18382b] dark:text-[#94e0b1]",
  info: "border-[#b3d1f1] bg-[#e8f2fe] text-[#1c4e82] dark:border-[#345b81] dark:bg-[#20344c] dark:text-[#aad2ff]",
  warning:
    "border-[#e6c38b] bg-[#fff3dc] text-[#754210] dark:border-[#765b34] dark:bg-[#40311e] dark:text-[#f5cd8d]",
  destructive:
    "border-[#e5b3b8] bg-[#fcebed] text-[#942c40] dark:border-[#82404e] dark:bg-[#42232c] dark:text-[#ffb7bf]",
  violet:
    "border-[#ccbdec] bg-[#f2ebfc] text-[#5f3988] dark:border-[#60507a] dark:bg-[#342a44] dark:text-[#dbc3fb]",
  teal: "border-[#a1d6d1] bg-[#e0f4f2] text-[#155957] dark:border-[#396462] dark:bg-[#193a3a] dark:text-[#95ded7]",
} as const;
