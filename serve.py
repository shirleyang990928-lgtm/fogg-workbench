# 本地开发服务器：禁止浏览器缓存，保证每次都加载磁盘上最新的代码
import http.server

PORT = 8090

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

print(f"课堂工作台已启动：http://localhost:{PORT}  （关闭这个窗口即停止）")
http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
