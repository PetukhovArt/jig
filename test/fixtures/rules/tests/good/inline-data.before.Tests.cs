public class CodecTests
{
    [Theory]
    [InlineData("10", 1)]
    public void Writes(string order, int value) => Assert.Equal(value, Codec.Write(order));
}
