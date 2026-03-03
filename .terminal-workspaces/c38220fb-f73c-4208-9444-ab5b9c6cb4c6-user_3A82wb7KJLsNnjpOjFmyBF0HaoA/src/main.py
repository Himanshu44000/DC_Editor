def greet(name: str) -> str:
    return f'Hello, {name}!'


def main() -> None:
    print(greet('from Python CLI'))


if __name__ == '__main__':
    main()
