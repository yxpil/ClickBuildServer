/** Tailwind 配置：只用黑白灰，接近 Win95 / Word 97 / Excel 97 的办公软件观感 */
module.exports = {
  content: ['./renderer/wbench.html', './renderer/wbench.js'],
  theme: {
    extend: {
      fontFamily: {
        office: ['Tahoma', 'SimSun', 'MS Sans Serif', 'sans-serif'],
        grid: ['Consolas', 'Courier New', 'monospace'],
      },
      colors: {
        win: '#c0c0c0',
        pane: '#dcdcdc',
        paper: '#ffffff',
        line: '#808080',
        ink: '#000000',
        shade: '#404040',
      },
    },
  },
  plugins: [],
};
