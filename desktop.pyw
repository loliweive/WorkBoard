import threading
import time
import ctypes
import ctypes.wintypes as wt
import webview
from server import app

TITLE          = "任务看板"
ALPHA_INACTIVE = 70    # 非激活：约27%，融入壁纸
ALPHA_ACTIVE   = 242   # 激活：近乎不透明

user32            = ctypes.windll.user32
GWL_EXSTYLE       = -20
WS_EX_LAYERED     = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
LWA_ALPHA         = 0x00000002
VK_LBUTTON        = 0x01

_hwnd   = None
_active = False


def _apply(alpha, clickthrough):
    if not _hwnd:
        return
    ex = user32.GetWindowLongW(_hwnd, GWL_EXSTYLE)
    if clickthrough:
        ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT
    else:
        ex = (ex | WS_EX_LAYERED) & ~WS_EX_TRANSPARENT
    user32.SetWindowLongW(_hwnd, GWL_EXSTYLE, ex)
    user32.SetLayeredWindowAttributes(_hwnd, 0, alpha, LWA_ALPHA)


def _in_window(x, y):
    if not _hwnd:
        return False
    rect = wt.RECT()
    user32.GetWindowRect(_hwnd, ctypes.byref(rect))
    return rect.left <= x <= rect.right and rect.top <= y <= rect.bottom


def _poll_loop():
    """
    用轮询代替 WH_MOUSE_LL 全局钩子。
    WH_MOUSE_LL 回调在 Python 中因 GIL 争抢延迟返回，
    Windows 超时后会冻结鼠标输入。轮询完全避免这一问题。
    """
    global _active
    last_time = 0.0
    last_pos  = (0, 0)
    was_down  = False

    while True:
        time.sleep(0.016)  # ~60 fps，对激活响应足够
        is_down = bool(user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)

        if is_down and not was_down:
            pt = wt.POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            x, y = pt.x, pt.y

            if _in_window(x, y):
                if not _active:
                    now  = time.time()
                    dbl  = user32.GetDoubleClickTime() / 1000.0
                    near = abs(x - last_pos[0]) < 8 and abs(y - last_pos[1]) < 8
                    if now - last_time < dbl and near:
                        _active = True
                        _apply(ALPHA_ACTIVE, False)
                        last_time = 0.0
                    else:
                        last_time = now
                        last_pos  = (x, y)
            else:
                if _active:
                    _active = False
                    _apply(ALPHA_INACTIVE, True)

        was_down = is_down


def _setup():
    global _hwnd
    for _ in range(30):
        _hwnd = user32.FindWindowW(None, TITLE)
        if _hwnd:
            break
        time.sleep(0.2)
    if _hwnd:
        _apply(ALPHA_INACTIVE, True)
        threading.Thread(target=_poll_loop, daemon=True).start()


def _run_server():
    app.run(host="127.0.0.1", port=8765, debug=False, use_reloader=False)


if __name__ == "__main__":
    threading.Thread(target=_run_server, daemon=True).start()
    time.sleep(1)

    webview.create_window(
        TITLE,
        "http://127.0.0.1:8765",
        width=1100,
        height=750,
        resizable=True,
        on_top=True,
    )
    threading.Thread(target=_setup, daemon=True).start()
    webview.start()
