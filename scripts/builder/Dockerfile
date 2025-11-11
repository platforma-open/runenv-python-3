FROM rockylinux:8

# Contract between this container and build.js script.
ENV BUILD_CONTAINER=true

RUN yum install -y \
    gcc \
    gcc-c++ \
    make \
    autoconf \
    automake \
    libtool \
    wget \
    curl \
    unzip \
    patch \
    git \
    python3 \
    python3-pip \
    libffi-devel \
    bzip2-devel \
    readline-devel \
    ncurses-devel \
    openssl-devel \
    sqlite-devel \
    libuuid-devel \
    xz-devel \
    gdbm-devel \
    expat-devel \
    zlib-devel \
  && yum clean all \
  && python3 -m pip install pipx

RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin/ --skip-shell
RUN fnm install v20.19.5 \
  && fnm exec --using=v20.19.5 -- npm install --global --upgrade npm pnpm@10.13.1

COPY build.sh /build.sh
RUN chmod +x /build.sh

ENTRYPOINT ["/build.sh"]
