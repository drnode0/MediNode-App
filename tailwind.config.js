/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      // ブランド色「常盤（ときわ）」— 深い緑。アイコンの若葉を主役に据える。
      // 600が基準色（ボタン・アクティブ状態）。ダークモードのアクセントは300。
      colors: {
        brand: {
          50: '#f0f9f5',
          100: '#e7f3ee',
          200: '#c4e6d8',
          300: '#7bd0b0',
          400: '#4aae8c',
          500: '#2c8a6a',
          600: '#196b4f',
          700: '#155a42',
          800: '#124f3a',
          900: '#0d3a2b',
          DEFAULT: '#196b4f',
        },
      },
      // クイズの答え表示・バナー出現用のさりげないモーション。
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // オンボーディングのアイコンがゆっくり呼吸するように浮く
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up .22s ease-out both',
        float: 'float 3.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
