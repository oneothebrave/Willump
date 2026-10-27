# HeadMotion 本机回归

在仓库根目录运行，不连接硬件，也不写入真实 NVS：

```sh
mkdir -p .tmp/firmware-tests
c++ -std=c++17 -I firmware/stackchan/test/native/mocks -I firmware/stackchan/include firmware/stackchan/test/native/head_motion.cpp -o .tmp/firmware-tests/head-motion
.tmp/firmware-tests/head-motion
```

测试编译实际 `head_motion.h`、`head_policy.h` 和 `head_startup.h`，只替换硬件接口。
覆盖两种关机姿态、延迟 hello、迟就绪舵机、有限运动重试、全部协议事件、断线回平及重连抬头。
模拟接口拒绝访问 ID 2 以外的舵机、越界运动和原厂校准写入。

物理关机重启仍需单独进行真机验收；这些模拟检查不能替代真实断电测试。
