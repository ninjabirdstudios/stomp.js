stomp.js
========

A STOMP 1.0 and 1.1 implementation for the browser that supports text and
binary data as well as duplicate headers, with support for push-style parsing
and serialization to ArrayBuffer instances. The content-length header is
supported, as are variable-length message bodies.

There are a bunch of other STOMP libraries out there, but when reviewing them,
they all seem to be lacking support for various features - almost all of them
don't support binary body data, none support duplicate header fields, etc. So
this library was created.

The implementation includes both a ClientConnection type, which maintains a raw
socket connection to the message broker, as well as a ClientConnector type that
provides a bit more functionality, such as implementing a proper CONNECT and
DISCONNECT sequence.

STOMP frames and frame parsing is completely independent of the underlying
transport, so it should be easy enough to use a file stream as your data
source, which is good for testing.

This library is a port of the node-stompjs project. Where possible, interface
and feature parity will be maintained between the two projects.

License
-------

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
